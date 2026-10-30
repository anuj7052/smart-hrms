-- CreateIndex
CREATE INDEX "AttendanceLog_employeeId_date_idx" ON "AttendanceLog"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceLog_date_status_idx" ON "AttendanceLog"("date", "status");

-- CreateIndex
CREATE INDEX "Employee_isActive_department_idx" ON "Employee"("isActive", "department");

-- CreateIndex
CREATE INDEX "RawPunchLog_deviceId_timestamp_idx" ON "RawPunchLog"("deviceId", "timestamp");
