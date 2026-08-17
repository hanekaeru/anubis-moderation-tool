import { Global, Module } from "@nestjs/common";
import { RolePermissionsController } from "./role-permissions.controller";
import { RolePermissionsService } from "./role-permissions.service";

/**
 * Global : `JwtStrategy` resout les permissions de l'appelant a chaque requete,
 * et l'importer dans `AuthModule` creerait une dependance circulaire (le
 * controleur de ce module est lui-meme derriere le garde JWT).
 */
@Global()
@Module({
	controllers: [RolePermissionsController],
	providers: [RolePermissionsService],
	exports: [RolePermissionsService],
})
export class RolePermissionsModule {}
