CREATE TABLE `credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issuerId` int NOT NULL,
	`holderUserId` int,
	`holderWalletAddress` varchar(220),
	`credentialKey` varchar(180) NOT NULL,
	`title` varchar(180) NOT NULL,
	`subjectCommitment` varchar(220),
	`contractAddress` varchar(180),
	`networkId` varchar(32) NOT NULL DEFAULT 'testnet',
	`issuedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	`status` enum('active','expiring','revoked') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `credentials_credentialKey_unique` UNIQUE(`credentialKey`)
);
--> statement-breakpoint
CREATE TABLE `issuers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerUserId` int NOT NULL,
	`slug` varchar(120) NOT NULL,
	`displayName` varchar(180) NOT NULL,
	`did` varchar(320),
	`networkId` varchar(32) NOT NULL DEFAULT 'testnet',
	`contractAddress` varchar(180),
	`status` enum('active','suspended','revoked') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `issuers_id` PRIMARY KEY(`id`),
	CONSTRAINT `issuers_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `proofRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requesterUserId` int NOT NULL,
	`holderUserId` int,
	`issuerId` int,
	`requestKey` varchar(180) NOT NULL,
	`verifierName` varchar(180) NOT NULL,
	`purpose` text NOT NULL,
	`requestedAttributes` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`status` enum('pending','approved','declined','expired') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `proofRequests_id` PRIMARY KEY(`id`),
	CONSTRAINT `proofRequests_requestKey_unique` UNIQUE(`requestKey`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`proofRequestId` int NOT NULL,
	`verifierUserId` int NOT NULL,
	`holderUserId` int,
	`verificationKey` varchar(180) NOT NULL,
	`status` enum('verified','failed','revoked') NOT NULL,
	`transactionId` varchar(220),
	`resultSummary` text,
	`verifiedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `verifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `verifications_verificationKey_unique` UNIQUE(`verificationKey`)
);
--> statement-breakpoint
CREATE TABLE `walletConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`providerId` varchar(140) NOT NULL,
	`providerName` varchar(180) NOT NULL,
	`walletAddress` varchar(220) NOT NULL,
	`networkId` varchar(32) NOT NULL,
	`lastConnectedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `walletConnections_id` PRIMARY KEY(`id`)
);
