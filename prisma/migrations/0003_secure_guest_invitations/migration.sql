ALTER TABLE "Invitation" ADD COLUMN "roomName" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "acceptedById" TEXT;

CREATE INDEX "Invitation_roomName_idx" ON "Invitation"("roomName");
CREATE INDEX "Invitation_acceptedById_idx" ON "Invitation"("acceptedById");

ALTER TABLE "Invitation"
ADD CONSTRAINT "Invitation_acceptedById_fkey"
FOREIGN KEY ("acceptedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
