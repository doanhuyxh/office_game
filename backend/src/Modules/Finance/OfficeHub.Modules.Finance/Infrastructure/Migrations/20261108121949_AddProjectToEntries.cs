using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Finance.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProjectToEntries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ProjectId",
                schema: "finance",
                table: "expense_requests",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ProjectId",
                schema: "finance",
                table: "entries",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_entries_project",
                schema: "finance",
                table: "entries",
                column: "ProjectId",
                filter: "\"ProjectId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_entries_project",
                schema: "finance",
                table: "entries");

            migrationBuilder.DropColumn(
                name: "ProjectId",
                schema: "finance",
                table: "expense_requests");

            migrationBuilder.DropColumn(
                name: "ProjectId",
                schema: "finance",
                table: "entries");
        }
    }
}
