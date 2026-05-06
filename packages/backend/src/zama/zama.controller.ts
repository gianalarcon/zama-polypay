import { Body, Controller, Get, Param, ParseIntPipe, Post } from "@nestjs/common";
import { IsEthereumAddress, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";
import { ZamaService } from "./zama.service";

/**
 * Optional `creatorCommitment` makes the backend immediately auto-approve
 * the freshly created proposal on behalf of the creator (mirrors Polypay's
 * UX: creating a tx is implicitly your first approval).
 */
class CreateTransferProposalDto {
  @IsEthereumAddress()
  to!: string;

  @Matches(/^\d+$/, { message: "amount must be a positive decimal string" })
  amount!: string;

  @IsEthereumAddress()
  token!: string;

  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/)
  creatorCommitment?: string;
}

class CreateSetThresholdProposalDto {
  @IsInt()
  @Min(1)
  @Max(255)
  newThreshold!: number;

  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/)
  creatorCommitment?: string;
}

class CreateAddSignerProposalDto {
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/)
  commitment!: string;

  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/)
  creatorCommitment?: string;
}

class CreateRemoveSignerProposalDto {
  @IsInt()
  @Min(0)
  idx!: number;

  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/)
  creatorCommitment?: string;
}

class ApproveDto {
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/)
  commitment!: string;
}

@Controller("zama")
export class ZamaController {
  constructor(private readonly svc: ZamaService) {}

  // ---------- Relayer info (no account context) ----------

  @Get("relayer")
  getRelayerInfo() {
    return this.svc.getRelayerInfo();
  }

  // ---------- Per-account reads ----------

  @Get("accounts/:address/wallet")
  getWalletState(@Param("address") address: string) {
    return this.svc.getWalletState(address);
  }

  @Get("accounts/:address/proposals")
  listProposals(@Param("address") address: string) {
    return this.svc.listProposals(address);
  }

  @Get("accounts/:address/proposals/:id")
  getProposal(@Param("address") address: string, @Param("id", ParseIntPipe) id: number) {
    return this.svc.getProposal(address, id);
  }

  @Get("accounts/:address/proposals/:id/votes")
  listVotes(@Param("address") address: string, @Param("id", ParseIntPipe) id: number) {
    return this.svc.listVotes(address, id);
  }

  // ---------- Per-account proposals ----------

  @Post("accounts/:address/proposals/transfer")
  proposeTransfer(@Param("address") address: string, @Body() dto: CreateTransferProposalDto) {
    return this.svc.proposeTransfer(address, dto.to, dto.amount, dto.token, dto.creatorCommitment);
  }

  @Post("accounts/:address/proposals/set-threshold")
  proposeSetThreshold(@Param("address") address: string, @Body() dto: CreateSetThresholdProposalDto) {
    return this.svc.proposeSetThreshold(address, dto.newThreshold, dto.creatorCommitment);
  }

  @Post("accounts/:address/proposals/add-signer")
  proposeAddSigner(@Param("address") address: string, @Body() dto: CreateAddSignerProposalDto) {
    return this.svc.proposeAddSigner(address, dto.commitment, dto.creatorCommitment);
  }

  @Post("accounts/:address/proposals/remove-signer")
  proposeRemoveSigner(@Param("address") address: string, @Body() dto: CreateRemoveSignerProposalDto) {
    return this.svc.proposeRemoveSigner(address, dto.idx, dto.creatorCommitment);
  }

  @Post("accounts/:address/proposals/:id/approve")
  approve(
    @Param("address") address: string,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ApproveDto,
  ) {
    return this.svc.approve(address, id, dto.commitment);
  }

  @Post("accounts/:address/proposals/:id/execute")
  execute(@Param("address") address: string, @Param("id", ParseIntPipe) id: number) {
    return this.svc.execute(address, id);
  }
}
