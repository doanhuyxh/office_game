using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Notification.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialNotification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "notifications");

            migrationBuilder.CreateTable(
                name: "notifications",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Body = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Link = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReadAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EmailTo = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    EmailToName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    EmailStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EmailAttempts = table.Column<int>(type: "integer", nullable: false),
                    EmailNextAttemptAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EmailSentAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EmailError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notifications", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_notifications_EmailNextAttemptAt",
                schema: "notifications",
                table: "notifications",
                column: "EmailNextAttemptAt",
                filter: "\"EmailStatus\" = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_notifications_UserId_CreatedAt",
                schema: "notifications",
                table: "notifications",
                columns: new[] { "UserId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "notifications",
                schema: "notifications");
        }
    }
}
