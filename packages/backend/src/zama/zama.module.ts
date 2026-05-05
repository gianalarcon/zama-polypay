import { Module } from '@nestjs/common';
import { ZamaController } from './zama.controller';
import { ZamaService } from './zama.service';

@Module({
  controllers: [ZamaController],
  providers: [ZamaService],
  exports: [ZamaService],
})
export class ZamaModule {}
