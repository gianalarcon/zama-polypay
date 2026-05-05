import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ZamaService } from './zama.service';
import {
  ApproveDto,
  CreateAddSignerProposalDto,
  CreateRemoveSignerProposalDto,
  CreateSetThresholdProposalDto,
  CreateTransferProposalDto,
  InitializeWalletDto,
} from './dto/proposal.dto';

@Controller('zama')
export class ZamaController {
  constructor(private readonly svc: ZamaService) {}

  // ---------- Read ----------

  @Get('relayer')
  getRelayerInfo() {
    return this.svc.getRelayerInfo();
  }

  @Get('wallet')
  getWalletState() {
    return this.svc.getWalletState();
  }

  @Get('proposals/:id')
  getProposal(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getProposal(id);
  }

  // ---------- Init ----------

  @Post('initialize')
  initialize(@Body() dto: InitializeWalletDto) {
    return this.svc.initialize(dto.encOwners, dto.proof, dto.threshold);
  }

  // ---------- Propose (per type) ----------

  @Post('proposals/transfer')
  proposeTransfer(@Body() dto: CreateTransferProposalDto) {
    return this.svc.proposeTransfer(dto.to, dto.amount, dto.token);
  }

  @Post('proposals/set-threshold')
  proposeSetThreshold(@Body() dto: CreateSetThresholdProposalDto) {
    return this.svc.proposeSetThreshold(dto.newThreshold);
  }

  @Post('proposals/add-signer')
  proposeAddSigner(@Body() dto: CreateAddSignerProposalDto) {
    return this.svc.proposeAddSigner(dto.encNewOwner, dto.proof);
  }

  @Post('proposals/remove-signer')
  proposeRemoveSigner(@Body() dto: CreateRemoveSignerProposalDto) {
    return this.svc.proposeRemoveSigner(dto.idx);
  }

  // ---------- Approve ----------

  @Post('proposals/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveDto) {
    return this.svc.approve(id, dto.encSigner, dto.proof);
  }

  // ---------- Execute ----------

  @Post('proposals/:id/execute')
  execute(@Param('id', ParseIntPipe) id: number) {
    return this.svc.execute(id);
  }
}
