using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AgentSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_settings",
                schema: "projects",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    MaxBotTasksPerDay = table.Column<int>(type: "integer", nullable: false),
                    MaxBotStreak = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_settings", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_settings",
                schema: "projects");
        }
    }
}
