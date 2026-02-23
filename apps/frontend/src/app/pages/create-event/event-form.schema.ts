import {
  required,
  minLength,
  maxLength,
  validate,
  schema,
} from '@angular/forms/signals';

export type EventForm = {
  name: string;
  conference: string;
  eventType: string;
  sport: string;
  date: string;
  time: string;
  location: string;
  capacity: number;
  description: string;
  createdBy: string;
  createdByUserId: string;
};

export const eventTypeOptions = [
  { value: 'Workshop', label: 'Workshop' },
  { value: 'Conference', label: 'Conference' },
  { value: 'Meetup', label: 'Meetup' },
  { value: 'Training', label: 'Training' },
  { value: 'Competition', label: 'Competition' },
];

export const sportOptions = [
  { value: 'Running', label: 'Running' },
  { value: 'Cycling', label: 'Cycling' },
  { value: 'Swimming', label: 'Swimming' },
  { value: 'Triathlon', label: 'Triathlon' },
  { value: 'Marathon', label: 'Marathon' },
  { value: 'Trail Running', label: 'Trail Running' },
  { value: 'Other', label: 'Other' },
];

export const eventSchema = schema<EventForm>((path) => {
  required(path.name, { message: 'Event name is required' });
  minLength(path.name, 3, {
    message: 'Event name must be at least 3 characters',
  });
  maxLength(path.name, 100, {
    message: 'Event name must not exceed 100 characters',
  });

  required(path.conference, { message: 'Conference name is required' });
  minLength(path.conference, 2, {
    message: 'Conference name must be at least 2 characters',
  });
  maxLength(path.conference, 100, {
    message: 'Conference name must not exceed 100 characters',
  });

  required(path.eventType, { message: 'Please select an event type' });

  required(path.sport, { message: 'Sport is required' });
  minLength(path.sport, 2, {
    message: 'Sport name must be at least 2 characters',
  });
  maxLength(path.sport, 50, {
    message: 'Sport name must not exceed 50 characters',
  });

  required(path.date, { message: 'Event date is required' });

  required(path.time, { message: 'Event time is required' });

  required(path.location, { message: 'Location is required' });
  minLength(path.location, 3, {
    message: 'Location must be at least 3 characters',
  });
  maxLength(path.location, 200, {
    message: 'Location must not exceed 200 characters',
  });

  required(path.capacity, { message: 'Capacity is required' });
  validate(path.capacity, (ctx) => {
    const value = ctx.value();
    if (value < 1) {
      return { kind: 'min', message: 'Capacity must be at least 1' };
    }
    if (value > 10000) {
      return { kind: 'max', message: 'Capacity must not exceed 10,000' };
    }
    return null;
  });

  required(path.description, { message: 'Description is required' });
  minLength(path.description, 10, {
    message: 'Description must be at least 10 characters',
  });
  maxLength(path.description, 1000, {
    message: 'Description must not exceed 1000 characters',
  });

  required(path.createdBy, { message: 'Your name is required' });
});
