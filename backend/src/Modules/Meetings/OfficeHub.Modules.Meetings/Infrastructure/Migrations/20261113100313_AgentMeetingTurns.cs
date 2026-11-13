using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Meetings.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AgentMeetingTurns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CurrentSpeakerEmployeeId",
                schema: "meetings",
                table: "agent_sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<List<Guid>>(
                name: "QueuedSpeakerIds",
                schema: "meetings",
                table: "agent_sessions",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "TurnStartedAt",
                schema: "meetings",
                table: "agent_sessions",
                type: "timestamp with time zone",
                nullable: true);

            // Phiên đang họp từ trước TEST-75: lượt về bot chủ trì
            migrationBuilder.Sql("""
                UPDATE meetings.agent_sessions SET "CurrentSpeakerEmployeeId" = "ChairEmployeeId", "TurnStartedAt" = now()
                WHERE "Status" = 'Active';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CurrentSpeakerEmployeeId",
                schema: "meetings",
                table: "agent_sessions");

            migrationBuilder.DropColumn(
                name: "QueuedSpeakerIds",
                schema: "meetings",
                table: "agent_sessions");

            migrationBuilder.DropColumn(
                name: "TurnStartedAt",
                schema: "meetings",
                table: "agent_sessions");
        }
    }
}
