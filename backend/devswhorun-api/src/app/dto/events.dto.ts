import { ApiProperty } from '@nestjs/swagger';

export class EventsDto {
  @ApiProperty()
  conferenceName: string;

  @ApiProperty()
  location: string;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;
}

export class Event {
  id: string;
  conferenceName: string;
  location: string;
  startDate: Date;
  endDate: Date;
}
