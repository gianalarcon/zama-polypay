import { IsEthereumAddress, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateTransferProposalDto {
  @IsEthereumAddress()
  to!: string;

  /** decimal string (wei or USDC base units) */
  @Matches(/^\d+$/, { message: 'amount must be a positive decimal string' })
  amount!: string;

  /** zero-address means native ETH */
  @IsEthereumAddress()
  token!: string;
}

export class CreateSetThresholdProposalDto {
  @IsInt()
  @Min(1)
  @Max(255)
  newThreshold!: number;
}

export class CreateAddSignerProposalDto {
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{64}$/)
  encNewOwner!: string;

  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/)
  proof!: string;
}

export class CreateRemoveSignerProposalDto {
  @IsInt()
  @Min(0)
  idx!: number;
}

export class InitializeWalletDto {
  /** array of bytes32 handles, one per encrypted owner address */
  @IsString({ each: true })
  encOwners!: string[];

  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/)
  proof!: string;

  @IsInt()
  @Min(1)
  @Max(32)
  threshold!: number;
}

export class ApproveDto {
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{64}$/)
  encSigner!: string;

  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/)
  proof!: string;

  @IsOptional()
  @IsString()
  walletAddress?: string;
}
