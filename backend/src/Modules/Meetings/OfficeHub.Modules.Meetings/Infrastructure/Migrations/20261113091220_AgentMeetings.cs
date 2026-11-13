using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Meetings.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AgentMeetings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_sessions",
                schema: "meetings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Topic = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    OpenedByEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    OpenedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    OpenedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ChairEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    EndReason = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    EndedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    TurnsUsed = table.Column<int>(type: "integer", nullable: false),
                    MaxTurns = table.Column<int>(type: "integer", nullable: false),
                    MaxMinutes = table.Column<int>(type: "integer", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_sessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "agent_settings",
                schema: "meetings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    MaxTurns = table.Column<int>(type: "integer", nullable: false),
                    MaxMinutes = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_settings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "agent_session_bots",
                schema: "meetings",
                columns: table => new
                {
                    MeetingId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_session_bots", x => new { x.MeetingId, x.EmployeeId });
                    table.ForeignKey(
                        name: "FK_agent_session_bots_agent_sessions_MeetingId",
                        column: x => x.MeetingId,
                        principalSchema: "meetings",
                        principalTable: "agent_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_agent_session_bots_user",
                schema: "meetings",
                table: "agent_session_bots",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "ix_agent_sessions_status_started",
                schema: "meetings",
                table: "agent_sessions",
                columns: new[] { "Status", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "ux_agent_sessions_room_active",
                schema: "meetings",
                table: "agent_sessions",
                column: "RoomId",
                unique: true,
                filter: "\"Status\" = 'Active'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_session_bots",
                schema: "meetings");

            migrationBuilder.DropTable(
                name: "agent_settings",
                schema: "meetings");

            migrationBuilder.DropTable(
                name: "agent_sessions",
                schema: "meetings");
        }
    }
}
