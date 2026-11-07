using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Documents.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "documents");

            migrationBuilder.CreateTable(
                name: "doc_types",
                schema: "documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    RetentionYears = table.Column<int>(type: "integer", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_doc_types", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "folders",
                schema: "documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SpaceKind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SpaceId = table.Column<Guid>(type: "uuid", nullable: true),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_folders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_folders_folders_ParentId",
                        column: x => x.ParentId,
                        principalSchema: "documents",
                        principalTable: "folders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "projects",
                schema: "documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DepartmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_projects", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "sequences",
                schema: "documents",
                columns: table => new
                {
                    Scope = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Value = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sequences", x => x.Scope);
                });

            migrationBuilder.CreateTable(
                name: "upload_tickets",
                schema: "documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FileKey = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    FileName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_upload_tickets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "assets",
                schema: "documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    Tags = table.Column<List<string>>(type: "text[]", nullable: false),
                    SpaceKind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SpaceId = table.Column<Guid>(type: "uuid", nullable: true),
                    FolderId = table.Column<Guid>(type: "uuid", nullable: true),
                    DocTypeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Classification = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CurrentVersion = table.Column<int>(type: "integer", nullable: false),
                    TotalSize = table.Column<long>(type: "bigint", nullable: false),
                    CustodianEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    CustodianName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DocumentNumber = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ApprovalRequestId = table.Column<Guid>(type: "uuid", nullable: true),
                    RejectReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    RetentionUntil = table.Column<DateOnly>(type: "date", nullable: true),
                    RetentionNotifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DestroyedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DestroyReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    DestroyedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeletedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_assets_doc_types_DocTypeId",
                        column: x => x.DocTypeId,
                        principalSchema: "documents",
                        principalTable: "doc_types",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_assets_folders_FolderId",
                        column: x => x.FolderId,
                        principalSchema: "documents",
                        principalTable: "folders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "project_members",
                schema: "documents",
                columns: table => new
                {
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    AddedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_members", x => new { x.ProjectId, x.EmployeeId });
                    table.ForeignKey(
                        name: "FK_project_members_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalSchema: "documents",
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "access_logs",
                schema: "documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UserName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Action = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Ip = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_access_logs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_access_logs_assets_AssetId",
                        column: x => x.AssetId,
                        principalSchema: "documents",
                        principalTable: "assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "asset_versions",
                schema: "documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    FileKey = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    FileName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    UploadedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UploadedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UploadedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_asset_versions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_asset_versions_assets_AssetId",
                        column: x => x.AssetId,
                        principalSchema: "documents",
                        principalTable: "assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_access_logs_asset_at",
                schema: "documents",
                table: "access_logs",
                columns: new[] { "AssetId", "At" });

            migrationBuilder.CreateIndex(
                name: "ux_asset_versions_number",
                schema: "documents",
                table: "asset_versions",
                columns: new[] { "AssetId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_assets_custodian",
                schema: "documents",
                table: "assets",
                column: "CustodianEmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_assets_DocTypeId",
                schema: "documents",
                table: "assets",
                column: "DocTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_assets_FolderId",
                schema: "documents",
                table: "assets",
                column: "FolderId");

            migrationBuilder.CreateIndex(
                name: "ix_assets_retention",
                schema: "documents",
                table: "assets",
                column: "RetentionUntil",
                filter: "\"DestroyedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_assets_space_folder",
                schema: "documents",
                table: "assets",
                columns: new[] { "SpaceKind", "SpaceId", "FolderId" });

            migrationBuilder.CreateIndex(
                name: "ux_assets_code",
                schema: "documents",
                table: "assets",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_doc_types_code",
                schema: "documents",
                table: "doc_types",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_folders_ParentId",
                schema: "documents",
                table: "folders",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "ux_folders_space_parent_name",
                schema: "documents",
                table: "folders",
                columns: new[] { "SpaceKind", "SpaceId", "ParentId", "Name" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "ix_project_members_employee",
                schema: "documents",
                table: "project_members",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "ux_projects_code",
                schema: "documents",
                table: "projects",
                column: "Code",
                unique: true,
                filter: "\"DeletedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_upload_tickets_created",
                schema: "documents",
                table: "upload_tickets",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "access_logs",
                schema: "documents");

            migrationBuilder.DropTable(
                name: "asset_versions",
                schema: "documents");

            migrationBuilder.DropTable(
                name: "project_members",
                schema: "documents");

            migrationBuilder.DropTable(
                name: "sequences",
                schema: "documents");

            migrationBuilder.DropTable(
                name: "upload_tickets",
                schema: "documents");

            migrationBuilder.DropTable(
                name: "assets",
                schema: "documents");

            migrationBuilder.DropTable(
                name: "projects",
                schema: "documents");

            migrationBuilder.DropTable(
                name: "doc_types",
                schema: "documents");

            migrationBuilder.DropTable(
                name: "folders",
                schema: "documents");
        }
    }
}
