import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class UserResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() email!: string;
  @Expose() @ApiProperty() firstName!: string;
  @Expose() @ApiProperty() lastName!: string;
  @Expose() @ApiProperty() isActive!: boolean;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose() @ApiProperty({ type: [String] }) roles!: string[];

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
