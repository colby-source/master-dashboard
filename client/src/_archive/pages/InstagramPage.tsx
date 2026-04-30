import { InstagramPanel } from "@/components/panels/InstagramPanel"
import { InstagramDmPanel } from "@/components/panels/InstagramDmPanel"

export default function InstagramPage() {
  return (
    <div className="space-y-4">
      <InstagramPanel />
      <InstagramDmPanel />
    </div>
  )
}
