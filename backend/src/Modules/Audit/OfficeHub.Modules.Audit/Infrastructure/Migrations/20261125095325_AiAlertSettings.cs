using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Audit.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AiAlertSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_alert_settings",
                schema: "audit",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    BlockedThreshold = table.Column<int>(type: "integer", nullable: false),
                    ErrorsThreshold = table.Column<int>(type: "integer", nullable: false),
                    ErrorsPercent = table.Column<int>(type: "integer", nullable: false),
                    BurstWritesThreshold = table.Column<int>(type: "integer", nullable: false),
                    ChatSpamThreshold = table.Column<int>(type: "integer", nullable: false),
                    WindowMinutes = table.Column<int>(type: "integer", nullable: false),
                    CooldownMinutes = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_alert_settings", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_alert_settings",
                schema: "audit");
        }
    }
}
