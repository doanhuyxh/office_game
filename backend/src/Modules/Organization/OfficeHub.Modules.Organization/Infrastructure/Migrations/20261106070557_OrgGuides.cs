using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Organization.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OrgGuides : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Description",
                schema: "org",
                table: "positions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Guide",
                schema: "org",
                table: "positions",
                type: "character varying(10000)",
                maxLength: 10000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "GuideUpdatedAt",
                schema: "org",
                table: "positions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GuideUpdatedByName",
                schema: "org",
                table: "positions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Description",
                schema: "org",
                table: "departments",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Guide",
                schema: "org",
                table: "departments",
                type: "character varying(10000)",
                maxLength: 10000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "GuideUpdatedAt",
                schema: "org",
                table: "departments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GuideUpdatedByName",
                schema: "org",
                table: "departments",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Description",
                schema: "org",
                table: "positions");

            migrationBuilder.DropColumn(
                name: "Guide",
                schema: "org",
                table: "positions");

            migrationBuilder.DropColumn(
                name: "GuideUpdatedAt",
                schema: "org",
                table: "positions");

            migrationBuilder.DropColumn(
                name: "GuideUpdatedByName",
                schema: "org",
                table: "positions");

            migrationBuilder.DropColumn(
                name: "Description",
                schema: "org",
                table: "departments");

            migrationBuilder.DropColumn(
                name: "Guide",
                schema: "org",
                table: "departments");

            migrationBuilder.DropColumn(
                name: "GuideUpdatedAt",
                schema: "org",
                table: "departments");

            migrationBuilder.DropColumn(
                name: "GuideUpdatedByName",
                schema: "org",
                table: "departments");
        }
    }
}
