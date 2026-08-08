import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  database: { reachable: true; latencyMs: number };
}

/**
 * Sonde de supervision.
 *
 * Publique a dessein : un redemarrage automatique ou un equilibreur de charge
 * doit pouvoir l'interroger sans identifiants. Elle ne divulgue donc rien
 * d'exploitable — ni version, ni configuration, ni compte.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    const debut = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // 503 et non 500 : l'API repond, c'est sa dependance qui manque. La
      // distinction est ce qui permet a une supervision de reagir correctement.
      throw new ServiceUnavailableException('Base de donnees injoignable.');
    }

    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      database: { reachable: true, latencyMs: Date.now() - debut },
    };
  }
}
