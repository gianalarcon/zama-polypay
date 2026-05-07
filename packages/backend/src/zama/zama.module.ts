import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";
import { EventsGateway } from "./events.gateway";
import { ZamaController } from "./zama.controller";
import { ZamaService } from "./zama.service";

@Module({
  controllers: [ZamaController, AccountController],
  providers: [ZamaService, AccountService, EventsGateway],
  exports: [ZamaService, AccountService, EventsGateway],
})
export class ZamaModule {}
