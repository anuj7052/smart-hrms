-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "appCheckInDepartments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "appCheckInEmployeeIds" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "appCheckInEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "appCheckInScope" TEXT NOT NULL DEFAULT 'global';
