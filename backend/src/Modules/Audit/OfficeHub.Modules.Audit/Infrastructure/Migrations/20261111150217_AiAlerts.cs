using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Audit.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AiAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_alerts",
                schema: "audit",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Rule = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    WindowStart = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    WindowEnd = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false),
                    Total = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_alerts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ai_alerts_time",
                schema: "audit",
                table: "ai_alerts",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "ix_ai_alerts_user_rule",
                schema: "audit",
                table: "ai_alerts",
                columns: new[] { "UserId", "Rule", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_alerts",
                schema: "audit");
        }
    }
}
