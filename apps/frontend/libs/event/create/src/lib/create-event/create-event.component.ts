import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormGroup,
  FormBuilder,
  FormControl,
} from '@angular/forms';

@Component({
  selector: 'lib-create-event',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-event.component.html',
  styleUrl: './create-event.component.css',
})
export class CreateEventComponent implements OnInit {
  eventForm!: FormGroup;

  fb = inject(FormBuilder);

  ngOnInit(): void {
    this.eventForm = this.fb.nonNullable.group({
      name: '',
      banners: '',
      eventType: '',
      eventLocationDetails: this.fb.nonNullable.group({
        city: '',
        country: '',
        maxAttendees: 0,
      }),
    });
  }
}

export interface Events {
  name: string;
  banners: string;
  userDetails?: any;
  eventType: string;
  eventLocationDetails: {
    city: string;
    country: string;
    maxAttendees: number;
  };
}
