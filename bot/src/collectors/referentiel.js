const prisma = require('../prisma');

/**
 * Referentiel Discord : serveur, salons, roles, membres.
 *
 * Deux modes complementaires. Une synchronisation complete au demarrage remet
 * l'etat a plat — indispensable, car tout ce qui s'est passe pendant que le bot
 * etait hors ligne n'a genere aucun evenement. Ensuite, les evenements Discord
 * maintiennent cet etat au fil de l'eau.
 */

/**
 * Couples deja ecrits pendant cette execution.
 *
 * Les tables d'activite ont des cles etrangeres vers guilds, discord_users et
 * channels : ecrire une statistique pour un membre inconnu echouerait. Ce cache
 * evite de reverifier a chaque message ce qui a deja ete garanti une fois.
 */
const contexteConnu = new Set();

async function upsertGuild(guild) {
    await prisma.guild.upsert({
        where: { id: guild.id },
        update: { name: guild.name, iconUrl: guild.iconURL() },
        create: { id: guild.id, name: guild.name, iconUrl: guild.iconURL() },
    });
}

async function upsertUser(user) {
    const data = {
        username: user.username,
        globalName: user.globalName ?? null,
        discriminator: user.discriminator === '0' ? null : user.discriminator,
        avatarHash: user.avatar ?? null,
        isBot: user.bot,
        accountCreatedAt: user.createdAt,
    };

    await prisma.discordUser.upsert({
        where: { id: user.id },
        update: data,
        create: { id: user.id, ...data },
    });
}

async function upsertRole(role) {
    const data = {
        name: role.name,
        color: role.color,
        position: role.position,
        managed: role.managed,
        // Un role recree porte le meme identifiant : on annule une eventuelle
        // suppression precedente.
        deletedAt: null,
    };

    await prisma.role.upsert({
        where: { id: role.id },
        update: data,
        create: { id: role.id, guildId: role.guild.id, ...data },
    });
}

async function marquerRoleSupprime(roleId) {
    // Suppression logique : les evenements d'historique referencent ce role et
    // le supprimer pour de bon effacerait la chronologie des membres.
    await prisma.role.updateMany({
        where: { id: roleId, deletedAt: null },
        data: { deletedAt: new Date() },
    });
}

async function upsertChannel(channel) {
    if (!channel.guild) return;

    const data = {
        name: channel.name ?? '(sans nom)',
        type: channel.type,
        parentId: channel.parentId ?? null,
        position: channel.rawPosition ?? 0,
        deletedAt: null,
    };

    await prisma.channel.upsert({
        where: { id: channel.id },
        update: data,
        create: { id: channel.id, guildId: channel.guild.id, ...data },
    });
}

async function marquerSalonSupprime(channelId) {
    await prisma.channel.updateMany({
        where: { id: channelId, deletedAt: null },
        data: { deletedAt: new Date() },
    });
}

/**
 * Enregistre un membre et ses roles.
 *
 * `joinCount` n'est incremente que par l'evenement d'arrivee : une
 * synchronisation ne doit pas faire croire a de nouvelles arrivees.
 */
async function upsertMember(member) {
    await upsertUser(member.user);

    await prisma.member.upsert({
        where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
        update: {
            nickname: member.nickname ?? null,
            status: 'ACTIVE',
            joinedAt: member.joinedAt,
            leftAt: null,
            boostingSince: member.premiumSince ?? null,
        },
        create: {
            guildId: member.guild.id,
            userId: member.id,
            nickname: member.nickname ?? null,
            status: 'ACTIVE',
            joinedAt: member.joinedAt,
            boostingSince: member.premiumSince ?? null,
        },
    });

    await synchroniserRoles(member);
}

/**
 * Aligne member_roles sur l'etat reel du membre.
 *
 * Le role @everyone est ignore : tout le monde le porte, l'enregistrer
 * doublerait la table sans rien apprendre.
 */
async function synchroniserRoles(member) {
    const guildId = member.guild.id;
    const rolesActuels = member.roles.cache
        .filter(role => role.id !== guildId)
        .map(role => role.id);

    const rolesEnBase = await prisma.memberRole.findMany({
        where: { guildId, userId: member.id },
        select: { roleId: true },
    });

    const enBase = new Set(rolesEnBase.map(r => r.roleId));
    const ajoutes = rolesActuels.filter(id => !enBase.has(id));
    const retires = [...enBase].filter(id => !rolesActuels.includes(id));

    if (ajoutes.length) {
        await prisma.memberRole.createMany({
            data: ajoutes.map(roleId => ({ guildId, userId: member.id, roleId })),
            skipDuplicates: true,
        });
    }

    if (retires.length) {
        await prisma.memberRole.deleteMany({
            where: { guildId, userId: member.id, roleId: { in: retires } },
        });
    }

    return { ajoutes, retires };
}

/** Historise un ajout ou un retrait de role. */
async function enregistrerEvenementsRoles(guildId, userId, ajoutes, retires, actorId = null) {
    const evenements = [
        ...ajoutes.map(roleId => ({ guildId, userId, roleId, type: 'ADDED', actorId })),
        ...retires.map(roleId => ({ guildId, userId, roleId, type: 'REMOVED', actorId })),
    ];

    if (evenements.length) {
        await prisma.memberRoleEvent.createMany({ data: evenements });
    }
}

async function enregistrerEvenementIdentite(guildId, userId, type, oldValue, newValue) {
    if (oldValue === newValue) return;

    await prisma.identityEvent.create({
        data: { guildId, userId, type, oldValue, newValue },
    });
}

/**
 * Garantit que le serveur, le membre et le salon existent en base.
 *
 * Appele avant toute ecriture d'activite, pour ne pas violer les cles
 * etrangeres quand un membre parle sans avoir ete vu par la synchronisation.
 */
async function garantirContexte(guild, user, channel) {
    const cle = `${guild.id}:${user.id}:${channel?.id ?? '-'}`;
    if (contexteConnu.has(cle)) return true;

    try {
        await upsertGuild(guild);
        await upsertUser(user);

        await prisma.member.upsert({
            where: { guildId_userId: { guildId: guild.id, userId: user.id } },
            update: {},
            create: { guildId: guild.id, userId: user.id, status: 'ACTIVE' },
        });

        if (channel) await upsertChannel(channel);

        contexteConnu.add(cle);
        return true;
    } catch (err) {
        console.error('[Referentiel] Contexte non garanti :', err);
        return false;
    }
}

/**
 * Synchronisation complete au demarrage.
 *
 * Necessite l'intent privilegie Server Members pour recuperer la liste des
 * membres. Sans lui, `members.fetch()` echoue : le reste est tout de meme
 * synchronise et l'incident est signale une fois, sans arreter le bot.
 */
async function synchroniserServeur(guild) {
    const debut = Date.now();
    console.log(`[Referentiel] Synchronisation de ${guild.name}...`);

    await upsertGuild(guild);

    const roles = await guild.roles.fetch();
    for (const role of roles.values()) {
        if (role.id === guild.id) continue;
        await upsertRole(role);
    }

    const salons = await guild.channels.fetch();
    for (const salon of salons.values()) {
        if (salon) await upsertChannel(salon);
    }

    let membresSynchronises = 0;
    let membres = null;
    try {
        membres = await guild.members.fetch();
        for (const membre of membres.values()) {
            await upsertMember(membre);
            membresSynchronises++;
        }
    } catch (err) {
        console.error(
            '[Referentiel] Membres non recuperes. Activez l\'intent privilegie '
            + '"Server Members" dans le portail developpeur Discord, puis ajoutez '
            + 'GatewayIntentBits.GuildMembers aux intents du client.',
            err.message,
        );
    }

    // Les membres partis entre deux demarrages ne generent aucun evenement :
    // on les deduit de leur absence de la liste recuperee. Reutilise la liste
    // deja recuperee ci-dessus : un second guild.members.fetch() doublerait la
    // requete gateway (opcode 8) et rapproche du rate limit sur les redemarrages
    // frequents en dev (nodemon).
    if (membresSynchronises > 0) {
        const presents = [...membres.keys()];
        const { count } = await prisma.member.updateMany({
            where: { guildId: guild.id, status: 'ACTIVE', userId: { notIn: presents } },
            data: { status: 'LEFT', leftAt: new Date() },
        });
        if (count > 0) {
            console.log(`[Referentiel] ${count} depart(s) rattrape(s).`);
        }
    }

    console.log(
        `[Referentiel] ${guild.name} : ${roles.size} role(s), ${salons.size} salon(s), `
        + `${membresSynchronises} membre(s) en ${Date.now() - debut} ms.`,
    );
}

module.exports = {
    upsertGuild,
    upsertUser,
    upsertRole,
    marquerRoleSupprime,
    upsertChannel,
    marquerSalonSupprime,
    upsertMember,
    synchroniserRoles,
    enregistrerEvenementsRoles,
    enregistrerEvenementIdentite,
    garantirContexte,
    synchroniserServeur,
};
