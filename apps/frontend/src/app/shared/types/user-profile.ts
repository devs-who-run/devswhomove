export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  provider: string;
  country?: string;
  city?: string;
}
