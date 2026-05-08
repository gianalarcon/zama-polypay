import { Controller, Get } from "@nestjs/common";
import { PriceService } from "./price.service";

@Controller("prices")
export class PriceController {
  constructor(private readonly svc: PriceService) {}

  @Get()
  list() {
    return this.svc.getPrices();
  }
}
