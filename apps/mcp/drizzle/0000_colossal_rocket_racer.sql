CREATE SCHEMA "mcp";
--> statement-breakpoint
CREATE TYPE "mcp"."transport" AS ENUM('sse', 'streamable_http');--> statement-breakpoint
CREATE TABLE "mcp"."server_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"transport" "mcp"."transport" NOT NULL,
	"url" text NOT NULL,
	"request_init" json,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "server_configs_name_unique" UNIQUE("name"),
	CONSTRAINT "server_configs_url_unique" UNIQUE("url")
);
