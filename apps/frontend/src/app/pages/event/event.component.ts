import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

@Component({
  selector: 'app-event',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './event.component.html',
  styleUrl: './event.component.css',
})
export class EventComponent {
  conferences = [
    { id: 1, name: 'Angular Connect' },
    { id: 2, name: 'ng-conf' },
    { id: 3, name: 'ngVikings' },
  ];

  eventForm = new FormGroup({
    conference: new FormControl('', Validators.required),
    eventType: new FormControl('', Validators.required),
    date: new FormControl('', Validators.required),
    location: new FormControl('', Validators.required),
    name: new FormControl('', Validators.required),
    description: new FormControl('', Validators.required),
    time: new FormControl('', Validators.required),
    capacity: new FormControl('', Validators.required),
  });

  onSubmit() {
    if (this.eventForm.valid) {
      console.log(this.eventForm.value);
    } else {
      console.log('Form is invalid');
    }
  }
}
