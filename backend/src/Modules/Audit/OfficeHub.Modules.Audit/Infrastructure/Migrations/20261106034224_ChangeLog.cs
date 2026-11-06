using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Audit.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ChangeLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "changes",
                schema: "audit",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Source = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UserName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Module = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Entity = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    EntityId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EntityLabel = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Action = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    ChangesJson = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_changes", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_changes_entity",
                schema: "audit",
                table: "changes",
                columns: new[] { "Entity", "EntityId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "ix_changes_time",
                schema: "audit",
                table: "changes",
                column: "OccurredAt");

            migrationBuilder.CreateIndex(
                name: "ix_changes_user",
                schema: "audit",
                table: "changes",
                columns: new[] { "UserId", "OccurredAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "changes",
                schema: "audit");
        }
    }
}
