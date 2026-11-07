using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Documents.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AssetSubmittedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SubmittedByEmployeeId",
                schema: "documents",
                table: "assets",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SubmittedByEmployeeId",
                schema: "documents",
                table: "assets");
        }
    }
}
