# DonaTrainer — The Ultimate Amadeus GDS Simulator

DonaTrainer is a free, open-source, browser-based Amadeus GDS simulator designed for aspiring and current travel professionals. It provides a realistic, consequence-free environment to practice and master the complete cryptic command workflow, from booking and PNR management to ticketing and post-ticketing changes.

**[➡️ Launch the Simulator](https://donatek-fr.github.io/donatrainer/public/app/)**

![DonaTrainer Screenshot](https://raw.githubusercontent.com/donatek-fr/donatrainer/main/image_0437b5.png)

## The DonaTrainer Difference

* **The Ultimate Sandbox**: Practice without risk. Make mistakes, learn the flow, and build the confidence to perform flawlessly on a live system.
* **Real-World Chaos**: Our dynamic engine simulates real-world challenges like flight cancellations, forcing you to adapt and master problem-solving.
* **For the Community, By the Community**: This is our gift to the travel industry. A powerful, open-source tool built to be free and accessible to every aspiring agent.

## Full Feature Breakdown

DonaTrainer simulates a rich set of GDS functionalities:

#### ✈️ Core Booking & PNR Management
* **Complete Booking Flow**: `AN`, `SS`, `NM`, `AP`, `TKOK`, `RF`, `ER`.
* **PNR Servicing**: Retrieve (`RT`), Ignore (`IR`), view History (`RH`), and add Remarks (`RM`).
* **Advanced PNR Management**: Split PNRs (`SP`), cancel segments (`XE`), and update names (`NU`).

####  ticketing & Commercials
* **Pricing & Ticketing**: Price itineraries (`FXP`), display fare rules (`FQN`), and issue tickets (`TTP`).
* **Post-Ticketing**: Simulate same-day voids (`TWX`) and process refunds (`TRF`).
* **Ancillary Services**: Sell extra services (`FXA`, `FXK`) and add agency markups (`FCM`).

#### 🧠 Dynamic & Realistic Engine
* **Irregular Operations (IROPS)**: The system randomly cancels flights to simulate airline disruptions.
* **Guided Scenarios**: A built-in training mode guides you through real-world booking scenarios.
* **Queue Management**: Place PNRs on queues (`QP`), view queues (`QT`), and action them (`QS`).

## Getting Started

1.  Clone the repository:
    ```bash
    git clone [https://github.com/donatek-fr/donatrainer.git](https://github.com/donatek-fr/donatrainer.git)
    ```
2.  Navigate to the project directory:
    ```bash
    cd donatrainer
    ```
3.  Open the `public/index.html` file in your browser to view the landing page, or open `public/app/index.html` to launch the simulator directly.

## A Passion Project from Donabil

DonaTrainer was developed under the leadership of Mohammed Abdul Kahar as a commitment to providing powerful, accessible educational resources for the travel industry. It's our way of giving back to the community and ensuring the next generation of agents are the most skilled yet.

---
_Disclaimer: This is a high-fidelity simulator using mock data. It is not connected to any live airline inventory and cannot be used for real travel._