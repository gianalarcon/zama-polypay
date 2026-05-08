import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from "class-validator";
import { AccountService } from "./account.service";

class SignerDto {
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/)
  commitment!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsInt()
  @Min(0)
  ownerIndex!: number;

  @IsOptional()
  @IsBoolean()
  isCreator?: boolean;
}

class CreateAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsInt()
  @Min(1)
  @Max(32)
  threshold!: number;

  @ValidateNested({ each: true })
  @Type(() => SignerDto)
  signers!: SignerDto[];
}

class UpdateAccountDto {
  @IsOptional()
  @IsString()
  name?: string;
}

@Controller("zama/accounts")
export class AccountController {
  constructor(private readonly svc: AccountService) {}

  @Get()
  list(@Query("commitment") commitment?: string) {
    return this.svc.list({ commitment });
  }

  @Get(":address")
  byAddress(@Param("address") address: string) {
    return this.svc.findByAddress(address);
  }

  /** One-shot: deploy + server-side encrypt + initialize + persist. */
  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.svc.create({
      name: dto.name,
      threshold: dto.threshold,
      signers: dto.signers,
    });
  }

  @Patch(":address")
  update(@Param("address") address: string, @Body() dto: UpdateAccountDto) {
    return this.svc.update(address, dto);
  }
}
