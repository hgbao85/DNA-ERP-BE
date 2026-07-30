import { PartialType } from '@nestjs/swagger';
import { CreateSegmentSpecDto } from './create-segment-spec.dto';

export class UpdateSegmentSpecDto extends PartialType(CreateSegmentSpecDto) {}
