using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Assets.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AssetsDepreciationHandover : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DepreciationMonths",
                schema: "assets",
                table: "devices",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DepreciationMonths",
                schema: "assets",
                table: "categories",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "device_attachments",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    FileName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    FileKey = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    Ready = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeletedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_device_attachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_device_attachments_devices_DeviceId",
                        column: x => x.DeviceId,
                        principalSchema: "assets",
                        principalTable: "devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "handover_records",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EmployeeName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DepartmentName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DeviceCode = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    DeviceName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CategoryName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Brand = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Model = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    SerialNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RequiresConfirmation = table.Column<bool>(type: "boolean", nullable: false),
                    ConfirmedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ConfirmedIp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    RemindedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_handover_records", x => x.Id);
                    table.ForeignKey(
                        name: "FK_handover_records_device_assignments_AssignmentId",
                        column: x => x.AssignmentId,
                        principalSchema: "assets",
                        principalTable: "device_assignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_handover_records_devices_DeviceId",
                        column: x => x.DeviceId,
                        principalSchema: "assets",
                        principalTable: "devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "settings",
                schema: "assets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    HandoverTemplateKey = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    HandoverTemplateName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UpdatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_settings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_device_attachments_device",
                schema: "assets",
                table: "device_attachments",
                column: "DeviceId");

            migrationBuilder.CreateIndex(
                name: "IX_handover_records_AssignmentId",
                schema: "assets",
                table: "handover_records",
                column: "AssignmentId");

            migrationBuilder.CreateIndex(
                name: "ix_handover_records_device",
                schema: "assets",
                table: "handover_records",
                column: "DeviceId");

            migrationBuilder.CreateIndex(
                name: "ix_handover_records_employee",
                schema: "assets",
                table: "handover_records",
                columns: new[] { "EmployeeId", "ConfirmedAt" });

            migrationBuilder.CreateIndex(
                name: "ux_handover_records_number",
                schema: "assets",
                table: "handover_records",
                column: "Number",
                unique: true);

            // Số tháng khấu hao mặc định cho các loại đã seed (HR sửa được ở Danh mục) — giống AssetRules.DefaultDepreciationMonths
            migrationBuilder.Sql("""
                UPDATE assets.categories SET "DepreciationMonths" = 36 WHERE "Code" IN ('MT', 'MH', 'KH') AND "DepreciationMonths" IS NULL;
                UPDATE assets.categories SET "DepreciationMonths" = 24 WHERE "Code" IN ('DT', 'PK') AND "DepreciationMonths" IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "device_attachments",
                schema: "assets");

            migrationBuilder.DropTable(
                name: "handover_records",
                schema: "assets");

            migrationBuilder.DropTable(
                name: "settings",
                schema: "assets");

            migrationBuilder.DropColumn(
                name: "DepreciationMonths",
                schema: "assets",
                table: "devices");

            migrationBuilder.DropColumn(
                name: "DepreciationMonths",
                schema: "assets",
                table: "categories");
        }
    }
}
