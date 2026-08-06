import XPManager from '../../utils/xp_manager';

/**
 * Instance unique du systeme d'XP.
 *
 * Les commandes et les evenements doivent partager le meme buffer : deux
 * instances lisant la meme table se marcheraient dessus, et `/rank` afficherait
 * une valeur en retard sur ce qui est en attente d'ecriture.
 */
export default new XPManager();
