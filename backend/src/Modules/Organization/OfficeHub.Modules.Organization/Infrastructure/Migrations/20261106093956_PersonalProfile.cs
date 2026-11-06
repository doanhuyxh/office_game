using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Organization.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PersonalProfile : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AvatarKey",
                schema: "org",
                table: "employees",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankAccountEncrypted",
                schema: "org",
                table: "employees",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankAccountHolder",
                schema: "org",
                table: "employees",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankName",
                schema: "org",
                table: "employees",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CurrentAddress",
                schema: "org",
                table: "employees",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContactName",
                schema: "org",
                table: "employees",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContactPhone",
                schema: "org",
                table: "employees",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContactRelation",
                schema: "org",
                table: "employees",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "IdIssuedOn",
                schema: "org",
                table: "employees",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IdIssuedPlace",
                schema: "org",
                table: "employees",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IdNumberEncrypted",
                schema: "org",
                table: "employees",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PermanentAddress",
                schema: "org",
                table: "employees",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "profile_change_requests",
                schema: "org",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    DataEncrypted = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DecidedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RejectReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_profile_change_requests", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_profile_change_requests_EmployeeId_Status",
                schema: "org",
                table: "profile_change_requests",
                columns: new[] { "EmployeeId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_profile_change_requests_Status",
                schema: "org",
                table: "profile_change_requests",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "profile_change_requests",
                schema: "org");

            migrationBuilder.DropColumn(
                name: "AvatarKey",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "BankAccountEncrypted",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "BankAccountHolder",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "BankName",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "CurrentAddress",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "EmergencyContactName",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "EmergencyContactPhone",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "EmergencyContactRelation",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "IdIssuedOn",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "IdIssuedPlace",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "IdNumberEncrypted",
                schema: "org",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "PermanentAddress",
                schema: "org",
                table: "employees");
        }
    }
}
