using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Identity.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OAuth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "GrantId",
                schema: "identity",
                table: "access_tokens",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "oauth_clients",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    RedirectUris = table.Column<List<string>>(type: "text[]", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_oauth_clients", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "oauth_codes",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CodeHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ClientId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RedirectUri = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CodeChallenge = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Scope = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Resource = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ConsumedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    GrantId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_oauth_codes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_oauth_codes_oauth_clients_ClientId",
                        column: x => x.ClientId,
                        principalSchema: "identity",
                        principalTable: "oauth_clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_oauth_codes_users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "oauth_grants",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Scope = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RefreshHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PreviousRefreshHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    RefreshExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_oauth_grants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_oauth_grants_oauth_clients_ClientId",
                        column: x => x.ClientId,
                        principalSchema: "identity",
                        principalTable: "oauth_clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_oauth_grants_users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_access_tokens_GrantId",
                schema: "identity",
                table: "access_tokens",
                column: "GrantId");

            migrationBuilder.CreateIndex(
                name: "ux_oauth_clients_client_id",
                schema: "identity",
                table: "oauth_clients",
                column: "ClientId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_oauth_codes_ClientId",
                schema: "identity",
                table: "oauth_codes",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_oauth_codes_UserId",
                schema: "identity",
                table: "oauth_codes",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "ux_oauth_codes_hash",
                schema: "identity",
                table: "oauth_codes",
                column: "CodeHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_oauth_grants_ClientId",
                schema: "identity",
                table: "oauth_grants",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "ix_oauth_grants_prev_refresh",
                schema: "identity",
                table: "oauth_grants",
                column: "PreviousRefreshHash");

            migrationBuilder.CreateIndex(
                name: "ix_oauth_grants_user",
                schema: "identity",
                table: "oauth_grants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "ux_oauth_grants_refresh",
                schema: "identity",
                table: "oauth_grants",
                column: "RefreshHash",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_access_tokens_oauth_grants_GrantId",
                schema: "identity",
                table: "access_tokens",
                column: "GrantId",
                principalSchema: "identity",
                principalTable: "oauth_grants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_access_tokens_oauth_grants_GrantId",
                schema: "identity",
                table: "access_tokens");

            migrationBuilder.DropTable(
                name: "oauth_codes",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "oauth_grants",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "oauth_clients",
                schema: "identity");

            migrationBuilder.DropIndex(
                name: "IX_access_tokens_GrantId",
                schema: "identity",
                table: "access_tokens");

            migrationBuilder.DropColumn(
                name: "GrantId",
                schema: "identity",
                table: "access_tokens");
        }
    }
}
