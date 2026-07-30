import { PartialType } from '@nestjs/swagger';
import { CreatePieceDto } from './create-piece.dto';

export class UpdatePieceDto extends PartialType(CreatePieceDto) {}
