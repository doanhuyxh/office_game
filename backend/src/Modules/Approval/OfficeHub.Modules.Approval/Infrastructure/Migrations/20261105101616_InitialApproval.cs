using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Approval.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialApproval : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "approval");

            migrationBuilder.CreateTable(
                name: "requests",
                schema: "approval",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    SubjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequesterEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Summary = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_requests", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "steps",
                schema: "approval",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ApproverEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DecidedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Comment = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_steps", x => x.Id);
                    table.ForeignKey(
                        name: "FK_steps_requests_RequestId",
                        column: x => x.RequestId,
                        principalSchema: "approval",
                        principalTable: "requests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_requests_RequesterEmployeeId_Status",
                schema: "approval",
                table: "requests",
                columns: new[] { "RequesterEmployeeId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_requests_Type_SubjectId",
                schema: "approval",
                table: "requests",
                columns: new[] { "Type", "SubjectId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_steps_RequestId_Order",
                schema: "approval",
                table: "steps",
                columns: new[] { "RequestId", "Order" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_steps_Status_Kind_ApproverEmployeeId",
                schema: "approval",
                table: "steps",
                columns: new[] { "Status", "Kind", "ApproverEmployeeId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "steps",
                schema: "approval");

            migrationBuilder.DropTable(
                name: "requests",
                schema: "approval");
        }
    }
}
