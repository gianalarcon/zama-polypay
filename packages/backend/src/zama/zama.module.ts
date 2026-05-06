import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";
import { ZamaController } from "./zama.controller";
import { ZamaService } from "./zama.service";

@Module({
  controllers: [ZamaController, AccountController],
  providers: [ZamaService, AccountService],
  exports: [ZamaService, AccountService],
})
export class ZamaModule {}
