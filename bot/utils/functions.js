// `exports.module` au lieu de `module.exports` : la faute de frappe rendait ce
// module vide, et `checkIfUserGotRole` introuvable pour tout appelant.
module.exports = {
    checkIfUserGotRole: function (user, role) {
        return user.roles.cache.some(r => r.id === role);
    }
}
