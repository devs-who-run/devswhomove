import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthController } from './controllers/auth.controller';
import { AppwriteService } from './services/appwrite.service';
import appwriteConfig from './config/appwrite.config';
import { EventsController } from './controllers/events.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appwriteConfig],
      envFilePath: '.env',
    }),
  ],
  controllers: [AppController, AuthController, EventsController],
  providers: [AppService, AppwriteService],
})
export class AppModule {}
