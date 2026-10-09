// Category templates (S7.2). YNAB's Template Gallery offers ready-made groups of categories with
// suggested amounts; importing one adds the groups at the bottom of the plan and never overwrites
// anything, and each amount becomes a "Have a balance of …" target with no date (YNAB trial,
// 2026-10-09). These are HAFB's own templates, bundled with the app (no network). Amounts are in
// whole units of the plan's currency.

export interface TemplateCategory {
  name: string;
  /** Suggested amount in whole currency units; becomes a "Have a balance of" target. */
  amount?: number;
}

export interface TemplateGroup {
  name: string;
  categories: readonly TemplateCategory[];
}

export interface CategoryTemplate {
  id: string;
  name: string;
  description: string;
  groups: readonly TemplateGroup[];
}

const c = (name: string, amount?: number): TemplateCategory => (amount === undefined ? { name } : { name, amount });

export const TEMPLATES: readonly CategoryTemplate[] = [
  {
    id: 'starter',
    name: 'Starter Plan',
    description: 'A first set of categories for everyday bills, needs and wants. Rename or delete what doesn’t fit.',
    groups: [
      { name: 'Bills', categories: [c('Rent or Mortgage', 1500), c('Electric', 120), c('Water', 50), c('Internet', 70), c('Phone', 80), c('Insurance', 150)] },
      { name: 'Needs', categories: [c('Groceries', 600), c('Transportation', 200), c('Medical', 100), c('Household Supplies', 75)] },
      { name: 'Wants', categories: [c('Dining Out', 150), c('Entertainment', 60), c('Hobbies', 50), c('Fun Money', 100)] },
      { name: 'Savings Goals', categories: [c('Emergency Fund', 1000), c('Vacation', 1200), c('Gifts', 500)] },
    ],
  },
  {
    id: 'irregular',
    name: 'Irregular Expenses',
    description: 'Costs that don’t come every month. Setting a little aside each month means the money is there when the bill is.',
    groups: [
      { name: 'Yearly Bills', categories: [c('Car Registration', 150), c('Car Insurance', 900), c('Home or Renter’s Insurance', 600), c('Property Taxes', 2400), c('Life Insurance', 500), c('Memberships', 120), c('Annual Card Fees', 95)] },
      { name: 'True Expenses', categories: [c('Car Maintenance', 600), c('Home Maintenance', 1500), c('Medical Deductible', 1000), c('Clothing', 600), c('Electronics Replacement', 600), c('Software Subscriptions', 200)] },
      { name: 'Celebrations', categories: [c('Birthdays', 300), c('Holidays', 800), c('Charitable Giving', 500)] },
    ],
  },
  {
    id: 'debt',
    name: 'Debt Payoff',
    description: 'A place for every debt payment and the habits that keep new debt away.',
    groups: [
      { name: 'Debt Payments', categories: [c('Credit Card Extra Payment'), c('Student Loan', 300), c('Car Loan', 400), c('Personal Loan', 200), c('Medical Bills', 100)] },
      { name: 'Staying Out of Debt', categories: [c('Starter Emergency Fund', 1000), c('Stuff I Forgot to Plan For', 200)] },
    ],
  },
  {
    id: 'baby',
    name: 'New Baby',
    description: 'Costs before and after a baby arrives, including the ones that are easy to miss.',
    groups: [
      { name: 'Baby', categories: [c('Medical and Delivery', 3000), c('Nursery and Furniture', 800), c('Car Seat and Stroller', 500), c('Diapers and Wipes', 900), c('Formula and Feeding', 1200), c('Clothes', 400), c('Childcare', 12000), c('Baby Savings', 600)] },
    ],
  },
  {
    id: 'pet',
    name: 'New Pet',
    description: 'From adoption day on: food, vet visits and the surprises in between.',
    groups: [
      { name: 'Pet', categories: [c('Adoption Fee', 250), c('Supplies', 300), c('Food', 600), c('Vet Checkups', 400), c('Pet Emergencies', 1000), c('Grooming', 300), c('Pet Sitting', 300)] },
    ],
  },
  {
    id: 'home',
    name: 'Buying a Home',
    description: 'Saving for a home and the costs that come with moving in.',
    groups: [
      { name: 'Home Purchase', categories: [c('Down Payment', 40000), c('Closing Costs', 8000), c('Inspection and Appraisal', 900), c('Moving', 2000), c('Furniture', 3000), c('First Repairs', 2500)] },
    ],
  },
  {
    id: 'car',
    name: 'Car Ownership',
    description: 'The full cost of a car, not only the payment.',
    groups: [
      { name: 'Car', categories: [c('Next Car Fund', 5000), c('Fuel', 1800), c('Insurance', 1200), c('Maintenance', 600), c('Tires', 800), c('Registration and Fees', 200), c('Parking and Tolls', 300)] },
    ],
  },
  {
    id: 'travel',
    name: 'Travel',
    description: 'Plan a trip and watch the money for it build up.',
    groups: [
      { name: 'Trip', categories: [c('Flights', 1200), c('Lodging', 1500), c('Food on the Road', 600), c('Activities', 500), c('Local Transport', 200), c('Souvenirs', 150), c('Travel Insurance', 100)] },
    ],
  },
  {
    id: 'holidays',
    name: 'Holidays',
    description: 'Plan the season ahead so January doesn’t bring a card balance.',
    groups: [
      { name: 'Holiday Season', categories: [c('Gifts', 800), c('Decorations', 150), c('Holiday Meals', 300), c('Holiday Travel', 600), c('Cards and Postage', 50), c('Hosting', 200)] },
    ],
  },
  {
    id: 'business',
    name: 'Small Business',
    description: 'Keep a side business’s money separate: costs, taxes and paying yourself.',
    groups: [
      { name: 'Business Costs', categories: [c('Software and Tools', 100), c('Supplies', 150), c('Marketing', 200), c('Professional Fees', 300), c('Equipment', 1000)] },
      { name: 'Business Obligations', categories: [c('Estimated Taxes', 3000), c('Business Insurance', 600), c('Pay Yourself', 1000)] },
    ],
  },
  {
    id: 'variable',
    name: 'Variable Income',
    description: 'For irregular paychecks: hold income back and live on last month’s money.',
    groups: [
      { name: 'Income Smoothing', categories: [c('Next Month’s Expenses', 4000), c('Lean Month Buffer', 3000), c('Taxes Set Aside', 2000)] },
    ],
  },
  {
    id: 'student',
    name: 'Student',
    description: 'Books, rent and a social life on a student budget.',
    groups: [
      { name: 'School', categories: [c('Tuition', 5000), c('Books and Supplies', 500), c('Housing', 6000), c('Meal Plan or Groceries', 2400)] },
      { name: 'Student Life', categories: [c('Transportation', 600), c('Social', 600), c('Trips Home', 400), c('Laptop Fund', 1000)] },
    ],
  },
];
