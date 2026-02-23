import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthController } from './controllers/auth.controller';
import { AppwriteService } from './services/appwrite.service';
import { EventService } from './services/event.service';
import appwriteConfig from './config/appwrite.config';
import { EventsController } from './controllers/events.controller';
import { UserProfileController } from './controllers/user-profile.controller';
import { UserProfileService } from './services/user-profile.service';
import { RegistrationService } from './services/registration.service';
import { RegistrationController } from './controllers/registration.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appwriteConfig],
      envFilePath: '.env',
    }),
  ],
  controllers: [
    AppController,
    AuthController,
    EventsController,
    UserProfileController,
    RegistrationController,
  ],
  providers: [
    AppService,
    AppwriteService,
    EventService,
    UserProfileService,
    RegistrationService,
  ],
})
export class AppModule {}
