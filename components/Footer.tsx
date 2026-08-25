import styles from './Footer.module.css';
import Link from 'next/link';

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@example.com';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.grid}>
          <div className={styles.section}>
            <h3 className={styles.heading}>About Us</h3>
            <p className={styles.text}>
              Your premium ecommerce destination powered by Shopify.
            </p>
          </div>
          
          <div className={styles.section}>
            <h3 className={styles.heading}>Quick Links</h3>
            <ul className={styles.list}>
              <li className={styles.listItem}>
                <Link href="/products" className={styles.link}>Products</Link>
              </li>
              <li className={styles.listItem}>
                <Link href="/cart" className={styles.link}>Cart</Link>
              </li>
            </ul>
          </div>
          
          <div className={styles.section}>
            <h3 className={styles.heading}>Contact</h3>
            <p className={styles.text}>
              Email: {supportEmail}<br />
              Phone: (555) 123-4567
            </p>
          </div>
        </div>
        
        <div className={styles.copyright}>
          <p>&copy; {new Date().getFullYear()} Shopify Store. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
