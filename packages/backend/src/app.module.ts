import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ZamaModule } from './zama/zama.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ZamaModule],
})
export class AppModule {}
