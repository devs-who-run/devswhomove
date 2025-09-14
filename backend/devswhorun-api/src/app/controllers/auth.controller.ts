import {
  Controller,
  Post,
  Body,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AppwriteService } from '../services/appwrite.service';
import {
  CreateOAuthUrlDto,
  AuthResponseDto,
  UserSessionDto,
} from '../dto/auth.dto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly appwriteService: AppwriteService) {}

  @Post('github/login')
  async initiateGitHubLogin(
    @Body() createOAuthUrlDto: CreateOAuthUrlDto
  ): Promise<AuthResponseDto> {
    let oauthUrl: string | void;
    try {
      const { successUrl, failureUrl } = createOAuthUrlDto;

      oauthUrl = await this.appwriteService.createGitHubOAuthUrl(
        successUrl,
        failureUrl
      );

      if (!oauthUrl) {
        throw new InternalServerErrorException('Failed to generate OAuth URL');
      }
      return {
        success: true,
        message: 'GitHub OAuth URL created successfully',
        data: { oauthUrl },
      };
    } catch (error) {
      this.logger.error('Failed to initiate GitHub login', error);
      throw new InternalServerErrorException('Failed to initiate GitHub login');
    }
  }

  @Post('exchange-secret')
  async exchangeSecretForSession(
    @Body() body: { secret: string; userId: string }
  ): Promise<AuthResponseDto> {
    try {
      const { secret, userId } = body;

      if (!secret || !userId) {
        throw new BadRequestException('Secret and userId are required');
      }

      const result = await this.appwriteService.createSessionFromCallback(
        userId,
        secret
      );

      return {
        success: true,
        message: 'Session created successfully',
        data: {
          secretToken: result.session.secret,
          user: {
            id: result.user.$id,
            name: result.user.name,
            email: result.user.email,
            avatar: result.user.prefs?.avatar || null,
            provider: result.user.prefs?.provider || 'github',
          },
        },
      };
    } catch (error) {
      this.logger.error('Failed to exchange secret for session', error);
      throw new InternalServerErrorException('Failed to create session');
    }
  }

  @Post('profile')
  async getUserProfile(
    @Body() userSessionDto: UserSessionDto
  ): Promise<AuthResponseDto> {
    try {
      const { secretToken } = userSessionDto;

      if (!secretToken) {
        throw new BadRequestException('Session ID is required');
      }

      const user = await this.appwriteService.getCurrentUser(secretToken);

      return {
        success: true,
        message: 'User profile retrieved successfully',
        data: {
          id: user.$id,
          name: user.name,
          email: user.email,
          avatar: user.prefs?.avatar || null,
          provider: user.prefs?.provider || 'github',
        },
      };
    } catch (error) {
      this.logger.error('Failed to get user profile', error);
      throw new InternalServerErrorException('Failed to retrieve user profile');
    }
  }

  @Post('logout')
  async logout(
    @Body() userSessionDto: UserSessionDto
  ): Promise<AuthResponseDto> {
    try {
      const { secretToken } = userSessionDto;

      if (!secretToken) {
        throw new BadRequestException('Session ID is required');
      }

      await this.appwriteService.deleteSession(secretToken);

      return {
        success: true,
        message: 'Logged out successfully',
      };
    } catch (error) {
      this.logger.error('Failed to logout user', error);
      throw new InternalServerErrorException('Failed to logout');
    }
  }

  @Post('verify')
  async verifySession(
    @Body() userSessionDto: UserSessionDto
  ): Promise<AuthResponseDto> {
    try {
      const { secretToken } = userSessionDto;

      if (!secretToken) {
        return {
          success: false,
          message: 'No session provided',
        };
      }

      const user = await this.appwriteService.getCurrentUser(secretToken);

      return {
        success: true,
        message: 'Session is valid',
        data: {
          id: user.$id,
          name: user.name,
          email: user.email,
          isAuthenticated: true,
        },
      };
    } catch (error) {
      this.logger.warn('Session verification failed', error);
      return {
        success: false,
        message: 'Invalid or expired session',
        data: { isAuthenticated: false },
      };
    }
  }
}
