import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

export enum RegistrationStatus {
  CONFIRMED = 'confirmed',
  WAITLIST = 'waitlist',
}

export class CreateRegistrationDto {
  @ApiProperty({ description: 'Event ID' })
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @ApiProperty({ description: 'User ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'User name' })
  @IsString()
  @IsNotEmpty()
  userName: string;
}

export class RegistrationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  eventId: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  userName: string;

  @ApiProperty({ enum: RegistrationStatus })
  status: RegistrationStatus;

  @ApiProperty({ required: false })
  waitlistPosition?: number;

  @ApiProperty()
  registeredAt: Date;
}

export class Registration {
  id: string;
  eventId: string;
  userId: string;
  userName: string;
  status: RegistrationStatus;
  waitlistPosition?: number;
  registeredAt: Date;
}

export class RegistrationCountsDto {
  @ApiProperty()
  confirmedCount: number;

  @ApiProperty()
  waitlistCount: number;

  @ApiProperty()
  availableSpots: number;
}
