import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { config } from '../../../config';

@Controller()
export class HealthController {
  @Get()
  @ApiExcludeEndpoint()
  health(): { status: string; service: string } {
    return { status: 'ok', service: config.serviceName };
  }
}
