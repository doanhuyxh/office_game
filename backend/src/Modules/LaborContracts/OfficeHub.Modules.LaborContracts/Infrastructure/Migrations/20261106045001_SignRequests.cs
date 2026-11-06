using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.LaborContracts.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SignRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "sign_requests",
                schema: "contracts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    SignerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    OriginalFileKey = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    OriginalSha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    OtpHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    OtpSentAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    OtpExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    OtpAttempts = table.Column<int>(type: "integer", nullable: false),
                    OtpSends = table.Column<int>(type: "integer", nullable: false),
                    SignedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SignerIp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SignerUserAgent = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    SignedFileKey = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    SignedSha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SignatureImageKey = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sign_requests", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_sign_requests_ContractId",
                schema: "contracts",
                table: "sign_requests",
                column: "ContractId");

            migrationBuilder.CreateIndex(
                name: "IX_sign_requests_SignerUserId_Status",
                schema: "contracts",
                table: "sign_requests",
                columns: new[] { "SignerUserId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "sign_requests",
                schema: "contracts");
        }
    }
}
