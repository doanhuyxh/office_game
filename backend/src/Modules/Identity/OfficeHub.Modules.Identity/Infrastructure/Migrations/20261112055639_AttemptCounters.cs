using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Identity.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AttemptCounters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "attempt_counters",
                schema: "identity",
                columns: table => new
                {
                    Key = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false),
                    Until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attempt_counters", x => x.Key);
                });

            migrationBuilder.CreateIndex(
                name: "ix_attempt_counters_until",
                schema: "identity",
                table: "attempt_counters",
                column: "Until");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "attempt_counters",
                schema: "identity");
        }
    }
}
