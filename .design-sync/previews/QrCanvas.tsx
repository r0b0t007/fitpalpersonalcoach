import { QrCanvas } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const InviteLink = () => (
  <Phone>
    <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ background: '#fff', padding: 12, borderRadius: 12 }}>
        <QrCanvas value="https://coach.fitpal.ma/?invite=7F3K9Q2M" size={200} />
      </div>
      <div className="small muted">Scan to join as a client</div>
    </div>
  </Phone>
)

export const Small = () => (
  <Phone>
    <div style={{ background: '#fff', padding: 8, borderRadius: 8, width: 'fit-content' }}>
      <QrCanvas value="FP-4421" size={96} />
    </div>
  </Phone>
)
