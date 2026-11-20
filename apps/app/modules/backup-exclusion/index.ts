import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class BackupExclusionModule extends NativeModule {
  exclude(path: string): void;
}

// iOS only: Android keeps app data out of backups through allowBackup, and the web has no device backups.
export default requireOptionalNativeModule<BackupExclusionModule>('BackupExclusion');
